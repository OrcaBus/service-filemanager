//! Errors used by the filemanager crate.
//!

use aws_sdk_s3::error::{DisplayErrorContext, ProvideErrorMetadata, SdkError};
use aws_sdk_s3::operation::get_object::GetObjectError;
use aws_sdk_s3::operation::get_object_tagging::GetObjectTaggingError;
use aws_sdk_s3::operation::head_object::HeadObjectError;
use aws_sdk_s3::operation::list_object_versions::ListObjectVersionsError;
use aws_sdk_s3::operation::put_object_tagging::PutObjectTaggingError;
use aws_sdk_sqs::operation::receive_message::ReceiveMessageError;
use aws_sdk_sqs::operation::send_message::SendMessageError;
use sea_orm::{DbErr, RuntimeErr};
use std::num::TryFromIntError;
use std::{error, io, result};
use thiserror::Error;
use url::ParseError;
use uuid::Uuid;

pub type Result<T> = result::Result<T, Error>;

/// Error types for the filemanager.
#[derive(Error, Debug)]
pub enum Error {
    #[error("database error: `{0}`")]
    DatabaseError(DbErr),
    #[error("SQS error: `{0}`")]
    SQSError(String),
    #[error("serde error: `{0}`")]
    SerdeError(String),
    #[error("loading environment variables: `{0}`")]
    ConfigError(String),
    #[error("credential generator error: `{0}`")]
    CredentialGeneratorError(String),
    #[error("S3 error: `{0}`")]
    S3Error(String),
    #[error("{0}")]
    IoError(#[from] io::Error),
    #[error("numerical operation overflowed")]
    OverflowError,
    #[error("numerical conversion failed: `{0}`")]
    ConversionError(String),
    #[error("query error: `{0}`")]
    QueryError(String),
    #[error("invalid input: `{0}`")]
    InvalidQuery(String),
    #[error("expected record for id: `{0}`")]
    ExpectedSomeValue(Uuid),
    #[error("error parsing: `{0}`")]
    ParseError(String),
    #[error("missing host header")]
    MissingHostHeader,
    #[error("creating presigned url: `{0}`")]
    PresignedUrlError(String),
    #[error("configuring API: `{0}`")]
    ApiConfigurationError(String),
    #[cfg(feature = "migrate")]
    #[error("SQL migrate error: `{0}`")]
    MigrateError(String),
    #[error("Crawl error: `{0}`")]
    CrawlError(String),
    #[error("Secrets manager error: `{0}`")]
    SecretsManagerError(String),
}

impl From<sqlx::Error> for Error {
    fn from(err: sqlx::Error) -> Self {
        Self::DatabaseError(DbErr::Query(RuntimeErr::SqlxError(err)))
    }
}

impl From<DbErr> for Error {
    fn from(err: DbErr) -> Self {
        Self::DatabaseError(err)
    }
}

impl From<serde_json::Error> for Error {
    fn from(err: serde_json::Error) -> Self {
        Self::SerdeError(err.to_string())
    }
}

impl From<envy::Error> for Error {
    fn from(error: envy::Error) -> Self {
        Self::ConfigError(error.to_string())
    }
}

impl From<ParseError> for Error {
    fn from(error: ParseError) -> Self {
        Self::ParseError(error.to_string())
    }
}

impl From<TryFromIntError> for Error {
    fn from(error: TryFromIntError) -> Self {
        Self::ConversionError(error.to_string())
    }
}

impl<T> From<(&SdkError<T>, String)> for Error
where
    T: ProvideErrorMetadata + error::Error + Send + Sync + 'static,
{
    fn from((err, call): (&SdkError<T>, String)) -> Self {
        Self::S3Error(format!(
            "{} for {}: {}",
            err.code().unwrap_or("Unknown"),
            call,
            err.message()
                .map(|msg| msg.to_string())
                .or_else(|| err.as_service_error().map(|err| err.to_string()))
                .unwrap_or_else(|| DisplayErrorContext(&err).to_string())
        ))
    }
}

impl<T> From<(SdkError<T>, String)> for Error
where
    T: ProvideErrorMetadata + error::Error + Send + Sync + 'static,
{
    fn from((err, call): (SdkError<T>, String)) -> Self {
        (&err, call).into()
    }
}

/// Generate an impl for an AWS error type with the context of the API call.
macro_rules! generate_aws_error_impl {
    ($t:ty) => {
        impl From<SdkError<$t>> for Error {
            fn from(err: SdkError<$t>) -> Self {
                let api_call = stringify!($t);
                (
                    err,
                    api_call
                        .strip_suffix("Error")
                        .unwrap_or(api_call)
                        .to_string(),
                )
                    .into()
            }
        }
    };
}

generate_aws_error_impl!(HeadObjectError);
generate_aws_error_impl!(GetObjectError);
generate_aws_error_impl!(ListObjectVersionsError);
generate_aws_error_impl!(GetObjectTaggingError);
generate_aws_error_impl!(PutObjectTaggingError);
generate_aws_error_impl!(ReceiveMessageError);
generate_aws_error_impl!(SendMessageError);
