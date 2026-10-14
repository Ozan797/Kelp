use std::pin::Pin;
use std::task::{Context, Poll};

use aws_smithy_types::body::SdkBody;
use bytes::Bytes;
use http_body::{Body, Frame, SizeHint};

use super::ProgressFn;

pub struct ProgressBody {
    inner: SdkBody,
    report: ProgressFn,
    sent: u64,
}

impl ProgressBody {
    pub fn new(inner: SdkBody, report: ProgressFn) -> Self {
        Self {
            inner,
            report,
            sent: 0,
        }
    }
}

impl Body for ProgressBody {
    type Data = Bytes;
    type Error = <SdkBody as Body>::Error;

    fn poll_frame(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Self::Data>, Self::Error>>> {
        let this = self.get_mut();
        let polled = Pin::new(&mut this.inner).poll_frame(cx);
        if let Poll::Ready(Some(Ok(frame))) = &polled
            && let Some(data) = frame.data_ref()
        {
            this.sent += data.len() as u64;
            (this.report)(this.sent);
        }
        polled
    }

    fn is_end_stream(&self) -> bool {
        self.inner.is_end_stream()
    }

    fn size_hint(&self) -> SizeHint {
        Body::size_hint(&self.inner)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use aws_sdk_s3::primitives::ByteStream;

    use super::*;

    #[tokio::test]
    async fn reports_the_running_total_as_bytes_are_read() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let record = seen.clone();
        let body = ProgressBody::new(
            SdkBody::from("hello world"),
            Arc::new(move |sent| record.lock().unwrap().push(sent)),
        );
        let bytes = ByteStream::new(SdkBody::from_body_1_x(body))
            .collect()
            .await
            .unwrap()
            .into_bytes();
        assert_eq!(&bytes[..], b"hello world");
        assert_eq!(seen.lock().unwrap().last(), Some(&11));
    }
}
