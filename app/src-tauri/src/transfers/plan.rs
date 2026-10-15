use std::ops::Range;

pub const MIB: u64 = 1024 * 1024;
pub const MULTIPART_THRESHOLD: u64 = 16 * MIB;
pub const PART_SIZE: u64 = 8 * MIB;
const MAX_PARTS: u64 = 10_000;

pub fn uses_multipart(size: u64) -> bool {
    size > MULTIPART_THRESHOLD
}

pub fn part_size(size: u64) -> u64 {
    let smallest = size.div_ceil(MAX_PARTS).div_ceil(MIB) * MIB;
    smallest.max(PART_SIZE)
}

pub fn ranges(size: u64, part: u64) -> Vec<Range<u64>> {
    (0..size.div_ceil(part))
        .map(|index| index * part..((index + 1) * part).min(size))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn small_and_medium_files_use_eight_mebibyte_parts() {
        assert_eq!(part_size(16 * MIB), 8 * MIB);
        assert_eq!(part_size(80_000_000_000), 8 * MIB);
        assert_eq!(part_size(80 * 1024 * MIB), 9 * MIB);
    }

    #[test]
    fn huge_files_grow_their_parts_to_stay_under_ten_thousand() {
        let hundred_gib = 100 * 1024 * MIB;
        assert_eq!(part_size(hundred_gib), 11 * MIB);
        assert!(hundred_gib.div_ceil(part_size(hundred_gib)) <= 10_000);
        let five_tib = 5 * 1024 * 1024 * MIB;
        assert!(five_tib.div_ceil(part_size(five_tib)) <= 10_000);
    }

    #[test]
    fn ranges_cover_the_file_and_the_last_one_is_shorter() {
        assert_eq!(
            ranges(20 * MIB, 8 * MIB),
            vec![0..8 * MIB, 8 * MIB..16 * MIB, 16 * MIB..20 * MIB]
        );
        assert_eq!(ranges(16 * MIB, 8 * MIB).len(), 2);
        assert!(ranges(0, 8 * MIB).is_empty());
    }

    #[test]
    fn only_files_over_sixteen_mebibytes_use_multipart() {
        assert!(!uses_multipart(16 * MIB));
        assert!(uses_multipart(16 * MIB + 1));
    }
}
