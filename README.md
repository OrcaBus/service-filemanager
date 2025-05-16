# Filemanager

The filemanager tracks object state in S3 to show how objects are created, deleted or moved and maintains a queryable
table of the results.

See the [API guide][api] for how to use the filemanager API and the [architecture doc][architecture] for details on design.

## Development

The Rust workspace is located inside [`app`][app], see the [README][readme] for more details.

The [`infrastructure`][infrastructure] directory contains an AWS CDK deployment of filemanager, and automated CI/CD pipelines. The
[`bin`][bin] directory contains the entrypoint for the CDK app, and [`test`][test] contains infrastructure tests.

Both [`app`][app] and the top-level project contain Makefiles for local development.

[readme]: app/README.md
[app]: app
[bin]: bin
[infrastructure]: infrastructure
[test]: test
[api]: app/docs/API_GUIDE.md
[architecture]: app/docs/ARCHITECTURE.md
