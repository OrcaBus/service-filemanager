filemanager
--------------------------------------------------------------------------------

The filemanager tracks object state in S3 to show how objects are created, deleted or moved and maintains a queryable
table of the results. It does this by ingesting S3 events into a postgres database and filling out object metadata like
the storage class. It also supports annotating records with JSON key-values and tracking how objects move using S3 tags.

See the [API guide][api] for how to use the filemanager API and the [architecture doc][architecture] for details on design.

The documentation of the [app] has further details on how the filemanager works.

[app]: app

### API Endpoints
This service provides a RESTful API following OpenAPI conventions. The Swagger documentation of the production endpoint is available here:

```
https://file.prod.umccr.org/schema/swagger-ui
```

### Permissions & Access Control

The filemanager has somewhat complex permission requirements as it prioritizes ingesting S3 events, and fills out
optional information from calls like `HeadObject` and `GetObjectTagging`. If permissions are lacking, the filemanager
may not fail ingesting, but instead proceed with partial information.

In general, the following S3 permissions are required for full functionality:

* For ingesting objects and calling `HeadObject`:
  * `s3:GetObject`
  * `s3:GetObjectVersion`
* For crawling objects and listing buckets:
  * `s3:ListBucket`
  * `s3:ListBucketVersions`
* For tagging objects to track moves:
  * `s3:GetObjectTagging`
  * `s3:GetObjectVersionTagging`
  * `s3:PutObjectTagging`
  * `s3:PutObjectVersionTagging`

The filemanager may operation with a subset of these requirements and have limited functionality. For example, objects
will still be ingested if `HeadObject` fails. This behaviour may change in the future. Note that the version-based
permissions are not required if bucket versioning is not used.

Another complexity in permission requirements is that the cache, and archive buckets should be accessible across accounts.
This means that the bucket policy which allows the filemanager role access should have the above permissions set in the
infrastructure [repo][infrastructure].

In general, care should be taken when updating buckets for the filemanager, otherwise errors may occur.

The filemanager also requires permissions to access:

* The database with the `orcabus-rds-connect-filemanager` policy using an RDS IAM connection.
* Access to the `orcabus/file-manager-presign-user` secret with `secretsmanager:GetSecretValue` and `secretsmanager:DescribeSecret` for presigning S3 urls.
* Access to receiving events from the `orcabus-event-source-queue` SQS queue, VPC and CloudWatch access.

[infrastructure]: https://github.com/umccr/infrastructure/blob/master/terraform/stacks/unimelb/data_archive

### Change Management

This service employs a fully automated CI/CD pipeline that automatically builds and releases all changes to the `main`
code branch.

There are no automated changelogs or releases, however semantic versioning is followed for any manual release, and
[conventional commits][conventional-commits] are used for future automation.

[conventional-commits]: https://www.conventionalcommits.org/en/v1.0.0/

Operation
--------------------------------------------------------------------------------

See the [docs] directory for general docs and operation.

### SOPs

See [docs/operation/sop][sop].

### Usage Examples

See [docs/operation/API_GUIDE.md][usage].

[docs]: docs
[sop]: docs/operation/sop
[usage]: docs/operation/API_GUIDE.md

Infrastructure & Deployment
--------------------------------------------------------------------------------

The filemanager is a primarily a stateless service that consumes S3 events and maintains an API to query database
records. It also has a stateful `AccessKeySecret` user which is able to presign long-lived URLs, and an event source
SQS queue that receives S3 events from the event bus.

There are 4 Lambda functions using [`RustFunction`][rust-function] in the stateless stack:
* An `IngestFunction` which converts and inserts S3 events into the filemanager database.
* An `ApiFunction` which responds to requests using API Gateway.
* A `MigrateFunction` which migrates and makes changes to the database tables.
* An `InventoryFunctino` which consumes an S3 inventory instead of S3 events.

[rust-function]: https://github.com/cargo-lambda/cargo-lambda-cdk

### CDK Commands

You can access CDK commands using the `pnpm` wrapper script.

- **`cdk-stateless`**: Used to deploy the filemanager `RustFunction`s
- **`cdk-stateful`**: Used to deploy the filemanager `AccessKeySecret` and `EventSource`.

The type of stack to deploy is determined by the context set in the `./bin/deploy.ts` file. This ensures the correct stack is executed based on the provided context.

For example:

```sh
# Deploy a stateless stack
pnpm cdk-stateless <command>
```

```sh
# Deploy a stateful stack
pnpm cdk-stateful <command>
```

### Stacks

This CDK project manages multiple stacks. The root stack (the only one that does not include `DeploymentPipeline` in its stack ID)
is deployed in the toolchain account and sets up a CodePipeline for cross-environment deployments to `beta`, `gamma`, and `prod`.

To list all available stacks, run the `cdk-stateless` or `cdk-stateful` script:

```sh
pnpm cdk-stateless ls
```

Output:

```sh
OrcaBusStatelessFileManagerStack
OrcaBusStatelessFileManagerStack/DeploymentPipeline/OrcaBusBeta/FileManagerStack (OrcaBusBeta-FileManagerStack)
OrcaBusStatelessFileManagerStack/DeploymentPipeline/OrcaBusGamma/FileManagerStack (OrcaBusGamma-FileManagerStack)
OrcaBusStatelessFileManagerStack/DeploymentPipeline/OrcaBusProd/FileManagerStack (OrcaBusProd-FileManagerStack)
```

Development
--------------------------------------------------------------------------------

### Project Structure

The root of the project is an AWS CDK project and the main application logic lives inside the `./app` folder.

The project is organized into the following directories:

- **`./app`**: Contains the main application logic written in Rust.

- **`./bin/deploy.ts`**: Serves as the entry point of the application. It initializes two stacks: `stateless` and `stateful`.

- **`./infrastructure`**: Contains the infrastructure code for the project:
    - **`./infrastructure/toolchain`**: Includes stacks for the stateless and stateful resources deployed in the toolchain account. These stacks primarily set up the CodePipeline for cross-environment deployments.
    - **`./infrastructure/stage`**: Defines the stage stacks for different environments:
        - **`./infrastructure/stage/functions`**: Contains the filemanager function definitions.
        - **`./infrastructure/stage/config.ts`**: Contains environment-specific configuration files (e.g., `beta`, `gamma`, `prod`).
        - **`./infrastructure/stage/filemanager-stateless-stack.ts`**: The CDK stack entry point for provisioning stateless resources required by the application in `./app`.
        - **`./infrastructure/stage/filemanager-stateful-stack.ts`**: The CDK stack entry point for provisioning stateful resources required by the application in `./app`.

- **`.github/workflows/pr-tests.yml`**: Configures GitHub Actions to run tests for `make check-all` (linting and code style), tests defined in `./test`, and `make test` for the `./app` directory.

- **`./test`**: Contains tests for CDK code compliance against `cdk-nag`.

### Setup

#### Requirements

This project requires [Rust][rust] for development. It's recommended for it to be installed to make use of local bundling,
however to just deploy the stack, all that should be required is pnpm and nodejs:

```sh
node --version
v22.9.0

# Update Corepack (if necessary, as per pnpm documentation)
npm install --global corepack@latest

# Enable Corepack to use pnpm
corepack enable pnpm
```

#### Install Dependencies

To install pnpm dependencies, run:

```sh
make install
```

### Conventions

A top-level [`Makefile`][makefile] contains commands to install, build, lint and test code. See the [`Makefile`][makefile-app] in the [`app`][app] directory
for commands to run lints against the application code. There are links to the app `Makefile` in the top-level `Makefile`.

### Linting & Formatting

Automated checks are enforced via pre-commit hooks, ensuring only checked code is committed. For details consult the `.pre-commit-config.yaml` file.

To run linting and formatting checks on the whole project (this requires [Rust][rust]), use:

```sh
make check-all
```

To automatically fix issues with ESLint and Prettier, run:

```sh
make fix
```

### Testing

Tests for the application are contained in the `app` directory. Infrastructure and cdk-nag tests can be run by using:

```sh
make test
```

[rust]: https://www.rust-lang.org/
[makefile]: Makefile
[makefile-app]: app/Makefile
[readme]: app/README.md
[app]: app
[bin]: bin
[infrastructure]: infrastructure
[test]: test
[pnpm]: https://pnpm.io/
[filemanager]: https://github.com/OrcaBus/service-filemanager
[readme]: app/README.md
[api]: docs/operation/API_GUIDE.md
[architecture]: docs/architecture/ARCHITECTURE.md
