# CDK constructs for filemanager

This folder contains CDK constructs for filemanager which is used by the project
to instantiate and deploy filemanager.

## Overview

The primary component that is deployed in filemanager is Lambda functions for each of the lambda
crates within this project. This, alongside the shared database in OrcaBus allows the filemanager
to perform file ingestion, querying, etc.

### Inputs

The filemanager operates on S3 buckets, and expects queues as input which can recieve S3 events. It also requires
the bucket names to create policies that allow S3 's3:List*' and 's3:Get*' operations. These operations are used to
fetch additional object data such as storage classes.

### Migration

The filemanager expects a dedicated database within the shared database cluster, which it can use to store data.
Initially, the filemanager-migrate-lambda function is deployed to perform database table migrations using the
provider function construct. Then, the other Lambda functions are deployed normally within the filemanager
construct.

### Building

Note, the `RustFunction` compiles code using [`cargo-lambda`][cargo-lambda] locally if it is installed, otherwise it compiles
code inside a docker function. The compiled code is then used by CDK to run the Lambda function natively (i.e.
this only does a docker build, not docker-based runtime). For compilation speeds, it's recommended to use local
compilation if possible.

[cargo-lambda]: https://www.cargo-lambda.info/
