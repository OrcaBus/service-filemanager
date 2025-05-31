#!/bin/bash

run_crawl=$(dirname "$0")/run_crawl.sh

$run_crawl -b bucket -p prefix -v
