#!/bin/bash

verify_tags=''
bucket=''
prefix=''
while getopts 'b:p:v' flag; do
  case "${flag}" in
    b) bucket="${OPTARG}" ;;
    p) prefix="${OPTARG}" ;;
    v) verify_tags="true" ;;
    *) error "Unexpected option ${flag}" ;;
  esac
done

if [ -z "$bucket" ] || [ -z "$prefix" ]; then
  echo "Missing bucket or prefix!"
  exit 1
fi

declare -A tags
results=$(aws s3 ls "$bucket/$prefix" --recursive | awk '{print $4}')
while IFS= read -r line; do
    tagging=$(aws s3api get-object-tagging --bucket "$bucket" --key "$line" | jq '.TagSet | .[] | .Value')

    echo "Checking $bucket and $line ..."
    if [ -z "${tagging}" ]; then
      echo "Missing tag for $bucket and $line!"
      exit 1
    fi

    tags["$line"]=$tagging
done <<< "$results"

if [[ $verify_tags ]]; then
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

for key in "${!tags[@]}"; do
  updatedId=$(curl -H "Authorization: Bearer $TOKEN" "https://file.prod.umccr.org/api/v1/s3?bucket=$bucket&key=$key" | jq '.results | .[] | .ingestId')
  if [ "$updatedId" != "${tags[${key}]}" ]; then
    echo "mismatched tags for $key in $bucket!"
    exit 1
  fi
done

updated=$(curl -H "Authorization: Bearer $TOKEN" "https://file.prod.umccr.org/api/v1/s3?bucket=$bucket&key=$prefix*" | jq)
diff -u <(echo "$previous") <(echo "$updated") > "$(echo "$bucket" | tr "/" _)"_"$(echo "$prefix" | tr "/" _)".txt

# Assert that there are no lines which change the ingestId
ingestIds=$(diff -u <(echo "$previous") <(echo "$updated") | grep "\+ *\"ingestId\"")
if [ -n "$ingestIds" ]; then
  echo "ingest id updated!"
  exit 1
fi
