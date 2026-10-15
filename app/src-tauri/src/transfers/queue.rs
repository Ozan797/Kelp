use uuid::Uuid;

use super::model::{ItemState, Kind, Status, Transfer};

pub const MAX_RUNNING: usize = 4;

#[derive(Debug, Default)]
pub struct Queue {
    transfers: Vec<Transfer>,
}

impl Queue {
    pub fn new(transfers: Vec<Transfer>) -> Self {
        Self { transfers }
    }

    pub fn add(&mut self, transfer: Transfer) {
        self.transfers.push(transfer);
    }

    pub fn all(&self) -> &[Transfer] {
        &self.transfers
    }

    pub fn get(&self, id: Uuid) -> Option<&Transfer> {
        self.transfers.iter().find(|transfer| transfer.id == id)
    }

    pub fn get_mut(&mut self, id: Uuid) -> Option<&mut Transfer> {
        self.transfers.iter_mut().find(|transfer| transfer.id == id)
    }

    pub fn next_to_start(&self, running: usize) -> Vec<Uuid> {
        self.transfers
            .iter()
            .filter(|transfer| transfer.status == Status::Waiting)
            .take(MAX_RUNNING.saturating_sub(running))
            .map(|transfer| transfer.id)
            .collect()
    }

    pub fn pause(&mut self, id: Uuid) -> bool {
        self.change(
            id,
            |status| matches!(status, Status::Waiting) || status.is_active(),
            Status::Paused,
        )
    }

    pub fn resume(&mut self, id: Uuid) -> bool {
        self.change(id, |status| *status == Status::Paused, Status::Waiting)
    }

    pub fn retry(&mut self, id: Uuid) -> bool {
        let Some(transfer) = self.get_mut(id) else {
            return false;
        };
        if transfer.status != Status::Failed {
            return false;
        }
        for item in &mut transfer.items {
            if matches!(item.state, ItemState::Failed { .. }) {
                item.state = ItemState::Pending;
            }
        }
        transfer.status = Status::Waiting;
        transfer.error = None;
        true
    }

    pub fn finish(&mut self, id: Uuid) {
        let Some(transfer) = self.get_mut(id) else {
            return;
        };
        let failed: Vec<&str> = transfer
            .items
            .iter()
            .filter_map(|item| match &item.state {
                ItemState::Failed { message } | ItemState::Refused { message } => {
                    Some(message.as_str())
                }
                _ => None,
            })
            .collect();
        transfer.error = match (failed.as_slice(), transfer.kind) {
            ([], _) => None,
            ([only], Kind::File) => Some((*only).to_string()),
            ([_], Kind::Folder) => Some("1 file failed.".to_string()),
            (many, _) => Some(format!("{} files failed.", many.len())),
        };
        transfer.status = if transfer.error.is_some() {
            Status::Failed
        } else {
            Status::Finished
        };
    }

    pub fn remove(&mut self, id: Uuid) -> Option<Transfer> {
        let index = self
            .transfers
            .iter()
            .position(|transfer| transfer.id == id)?;
        Some(self.transfers.remove(index))
    }

    pub fn restore_after_launch(&mut self) {
        self.transfers
            .retain(|transfer| !matches!(transfer.status, Status::Finished | Status::Cancelled));
        for transfer in &mut self.transfers {
            if transfer.status.is_active() {
                transfer.status = Status::Waiting;
            }
        }
    }

    fn change(&mut self, id: Uuid, allowed: impl Fn(&Status) -> bool, to: Status) -> bool {
        match self.get_mut(id) {
            Some(transfer) if allowed(&transfer.status) => {
                transfer.status = to;
                true
            }
            _ => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transfers::model::tests::{item, transfer};

    fn queue_of(count: usize) -> (Queue, Vec<Uuid>) {
        let mut queue = Queue::default();
        let ids = (0..count)
            .map(|_| {
                let one = transfer(vec![item("a", 1)]);
                let id = one.id;
                queue.add(one);
                id
            })
            .collect();
        (queue, ids)
    }

    #[test]
    fn at_most_four_start_in_the_order_they_were_added() {
        let (queue, ids) = queue_of(6);
        assert_eq!(queue.next_to_start(0), ids[..4].to_vec());
        assert_eq!(queue.next_to_start(3), ids[..1].to_vec());
        assert!(queue.next_to_start(4).is_empty());
    }

    #[test]
    fn pausing_works_while_waiting_running_or_retrying() {
        let (mut queue, ids) = queue_of(3);
        queue.get_mut(ids[1]).unwrap().status = Status::Running;
        queue.get_mut(ids[2]).unwrap().status = Status::Retrying { at_ms: 9 };
        for id in &ids {
            assert!(queue.pause(*id));
            assert_eq!(queue.get(*id).unwrap().status, Status::Paused);
        }
        assert!(!queue.pause(ids[0]));
    }

    #[test]
    fn only_paused_transfers_resume() {
        let (mut queue, ids) = queue_of(1);
        assert!(!queue.resume(ids[0]));
        queue.pause(ids[0]);
        assert!(queue.resume(ids[0]));
        assert_eq!(queue.get(ids[0]).unwrap().status, Status::Waiting);
    }

    #[test]
    fn retry_sends_only_the_failed_items_again() {
        let mut queue = Queue::default();
        let mut folder = transfer(vec![item("a", 1), item("b", 1)]);
        folder.items[0].state = ItemState::Done;
        folder.items[1].state = ItemState::Failed {
            message: "x".into(),
        };
        folder.status = Status::Failed;
        folder.error = Some("1 file failed.".into());
        let id = folder.id;
        queue.add(folder);
        assert!(queue.retry(id));
        let retried = queue.get(id).unwrap();
        assert_eq!(retried.status, Status::Waiting);
        assert_eq!(retried.error, None);
        assert_eq!(retried.items[0].state, ItemState::Done);
        assert_eq!(retried.items[1].state, ItemState::Pending);
        assert!(!queue.retry(id));
    }

    #[test]
    fn retry_never_sends_refused_items() {
        let mut queue = Queue::default();
        let mut folder = transfer(vec![item("a", 1), item("../evil", 1)]);
        folder.items[0].state = ItemState::Done;
        folder.items[1].state = ItemState::Refused {
            message: "This name can't be saved on a Mac.".into(),
        };
        let id = folder.id;
        queue.add(folder);
        queue.finish(id);
        assert_eq!(
            queue.get(id).unwrap().error.as_deref(),
            Some("1 file failed.")
        );
        assert!(queue.retry(id));
        assert!(matches!(
            queue.get(id).unwrap().items[1].state,
            ItemState::Refused { .. }
        ));
    }

    #[test]
    fn finishing_a_folder_with_a_failed_file_fails_it_with_a_count() {
        let mut queue = Queue::default();
        let mut folder = transfer(vec![item("a", 1), item("b", 1)]);
        folder.items[0].state = ItemState::Done;
        folder.items[1].state = ItemState::Failed {
            message: "Access denied.".into(),
        };
        let id = folder.id;
        queue.add(folder);
        queue.finish(id);
        let done = queue.get(id).unwrap();
        assert_eq!(done.status, Status::Failed);
        assert_eq!(done.error.as_deref(), Some("1 file failed."));
    }

    #[test]
    fn a_failed_single_file_keeps_its_own_message() {
        let mut queue = Queue::default();
        let mut file = transfer(vec![item("a", 1)]);
        file.items[0].state = ItemState::Failed {
            message: "Access denied.".into(),
        };
        let id = file.id;
        queue.add(file);
        queue.finish(id);
        assert_eq!(
            queue.get(id).unwrap().error.as_deref(),
            Some("Access denied.")
        );
    }

    #[test]
    fn finishing_with_every_item_done_finishes() {
        let (mut queue, ids) = queue_of(1);
        queue.get_mut(ids[0]).unwrap().items[0].state = ItemState::Done;
        queue.finish(ids[0]);
        assert_eq!(queue.get(ids[0]).unwrap().status, Status::Finished);
    }

    #[test]
    fn after_launch_running_ones_wait_again_and_paused_and_failed_stay() {
        let (mut queue, ids) = queue_of(5);
        let states = [
            Status::Running,
            Status::Retrying { at_ms: 1 },
            Status::Paused,
            Status::Failed,
            Status::Finished,
        ];
        for (id, status) in ids.iter().zip(states) {
            queue.get_mut(*id).unwrap().status = status;
        }
        queue.restore_after_launch();
        let statuses: Vec<Status> = queue.all().iter().map(|t| t.status).collect();
        assert_eq!(
            statuses,
            vec![
                Status::Waiting,
                Status::Waiting,
                Status::Paused,
                Status::Failed
            ]
        );
    }

    #[test]
    fn removing_returns_the_transfer_once() {
        let (mut queue, ids) = queue_of(1);
        assert!(queue.remove(ids[0]).is_some());
        assert!(queue.remove(ids[0]).is_none());
        assert!(queue.all().is_empty());
    }
}
