#!/bin/bash

list_only=''
bucket=''
prefix=''
while getopts 'b:p:l' flag; do
  case "${flag}" in
    b) bucket="${OPTARG}" ;;
    p) prefix="${OPTARG}" ;;
    l) list_only="true" ;;
    *) error "Unexpected option ${flag}" ;;
  esac
done

if [ -z "$bucket" ] || [ -z "$prefix" ]; then
  echo "Missing bucket or prefix!"
  exit 1
fi

if [[ $list_only ]]; then
  aws s3 ls "$bucket/$prefix" --summarize --recursive
  exit 0
fi

expected_n_objects=$(aws s3 ls "$bucket/$prefix" --summarize --recursive | tail -2 | head -1 | sed -e "s/^Total Objects: //")

# Get the previous state in the filemanager
previous=$(curl -H "Authorization: Bearer $TOKEN" "https://file.prod.umccr.org/api/v1/s3?bucket=$bucket&key=$prefix*" | jq)

# Execute the crawl
crawl=$(curl -H "Authorization: Bearer $TOKEN" -X POST \
  --data "{ \"prefix\": \"$prefix\", \"bucket\": \"$bucket\" }" \
  -H "Content-Type: application/json" "https://file.prod.umccr.org/api/v1/s3/crawl/sync" | jq .nObjects)

# Assert that the number of objects matches the expected number crawled
if [ "$expected_n_objects" != "$crawl" ]; then
  echo "mismatched object number!"
  exit 1
fi

updated=$(curl -H "Authorization: Bearer $TOKEN" "https://file.prod.umccr.org/api/v1/s3?bucket=$bucket&key=$prefix*" | jq)

diff -u <(echo "$previous") <(echo "$updated") > "$(echo "$bucket" | tr "/" _)"_"$(echo "$prefix" | tr "/" _)".txt

# Assert that there are no lines which change the ingestId
ingestIds=$(diff -u <(echo "$previous") <(echo "$updated") | grep "\+ *\"ingestId\"")
if [ -n "$ingestIds" ]; then
  echo "ingest id updated!"
  exit 1
fi
