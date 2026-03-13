//! This module converts storage events into database objects.
//!

use crate::error::Result;
use crate::events::aws::collecter::CrawlNRecords;
use crate::events::aws::{Events, TransposedS3EventMessages};
use async_trait::async_trait;

pub mod aws;

/// This trait processes raw events into a common type that can easily be consumed by the database.
#[async_trait]
pub trait Collect {
    /// Collect into events.
    async fn collect(self) -> Result<EventSource>;
}

/// The event source with a type and the number of (potentially duplicate) records contained.
#[derive(Debug, Clone)]
pub struct EventSource {
    event_type: EventSourceType,
    n_records: usize,
    crawl_n_records: Option<CrawlNRecords>,
}

impl EventSource {
    /// Create a new event source.
    pub fn new(
        event_type: EventSourceType,
        n_records: usize,
        crawl_n_records: Option<CrawlNRecords>,
    ) -> Self {
        Self {
            event_type,
            n_records,
            crawl_n_records,
        }
    }

    /// Get the inner values.
    pub fn into_inner(self) -> (EventSourceType, usize, Option<CrawlNRecords>) {
        (self.event_type, self.n_records, self.crawl_n_records)
    }

    /// Get the total number of new records to be inserted.
    pub fn n_records(&self) -> usize {
        self.n_records
    }
}

/// The type of event.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone)]
#[non_exhaustive]
pub enum EventSourceType {
    S3(TransposedS3EventMessages),
    S3Paired(Events),
}
