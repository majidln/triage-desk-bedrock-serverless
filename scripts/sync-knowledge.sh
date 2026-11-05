#!/usr/bin/env bash
# Moves knowledge/ into the Knowledge Base, and cleans up before the stack is deleted.
#
#   scripts/sync-knowledge.sh                    upload, then ingest: what you run after editing a guide
#   scripts/sync-knowledge.sh upload [--dryrun]  only sync help-center/ and internal/ to the docs bucket, as .txt
#   scripts/sync-knowledge.sh ingest             only start an ingestion job and wait for it to finish
#   scripts/sync-knowledge.sh empty              delete every file in the bucket, so the stack can be deleted
#
# Names come from the stack's outputs: KnowledgeDocsBucketName, and for ingest also
# KnowledgeBaseId and KnowledgeDataSourceId.
set -euo pipefail
# Each lookup below ends in `|| exit 1`: set -e is switched off inside a function called
# as part of `&&` or `if`, and an empty bucket name must never reach an aws s3 command.

# Print straight to the terminal: the CLI's pager would stop the script at the first JSON output
export AWS_PAGER=""

STACK="${STACK:-triage-desk}"
REGION="${AWS_REGION:-us-east-1}"
KNOWLEDGE_DIR="$(cd "$(dirname "$0")/../knowledge" && pwd)"

output() {
  local value
  value=$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text)
  if [[ -z "$value" || "$value" == "None" ]]; then
    echo "Stack $STACK has no output $1. Is it deployed with that output?" >&2
    exit 1
  fi
  echo "$value"
}

upload() {
  local bucket file
  bucket=$(output KnowledgeDocsBucketName) || exit 1

  # Uploaded as .txt, not .md: for a .md file Bedrock chunks by Markdown structure and stores
  # the whole file as every chunk's parent, so Retrieve returns whole files and the data
  # source's chunking settings barely matter. As .txt the chunking is exactly what's configured.
  # Only help-center/ and internal/ are staged: README.md and COVERAGE.md stay out.
  # Not local: the EXIT trap runs after this function has returned
  staging=$(mktemp -d)
  trap 'rm -rf "$staging"' EXIT
  for file in "$KNOWLEDGE_DIR"/help-center/*.md "$KNOWLEDGE_DIR"/internal/*.md; do
    mkdir -p "$staging/$(basename "$(dirname "$file")")"
    # -p keeps the modification time, so sync skips files that haven't changed
    cp -p "$file" "$staging/$(basename "$(dirname "$file")")/$(basename "$file" .md).txt"
  done

  # --delete removes files deleted locally, or old documents would be indexed next to new ones
  aws s3 sync "$staging/" "s3://$bucket/" --region "$REGION" --delete "$@"
  echo "In s3://$bucket:"
  aws s3 ls "s3://$bucket/" --recursive --region "$REGION"
}

ingest() {
  local kb ds job status
  kb=$(output KnowledgeBaseId) || exit 1
  ds=$(output KnowledgeDataSourceId) || exit 1
  job=$(aws bedrock-agent start-ingestion-job --knowledge-base-id "$kb" --data-source-id "$ds" \
    --region "$REGION" --query ingestionJob.ingestionJobId --output text)
  echo "Ingestion job $job started"

  while true; do
    status=$(aws bedrock-agent get-ingestion-job --knowledge-base-id "$kb" --data-source-id "$ds" \
      --ingestion-job-id "$job" --region "$REGION" --query ingestionJob.status --output text)
    case "$status" in
      COMPLETE | FAILED | STOPPED) break ;;
      *) echo "  $status"; sleep 5 ;;
    esac
  done

  # Documents scanned, indexed, modified, deleted and failed, and why any failed
  aws bedrock-agent get-ingestion-job --knowledge-base-id "$kb" --data-source-id "$ds" \
    --ingestion-job-id "$job" --region "$REGION" \
    --query '{status: ingestionJob.status, statistics: ingestionJob.statistics, failureReasons: ingestionJob.failureReasons}'
  [[ "$status" == COMPLETE ]]
}

empty() {
  local bucket
  bucket=$(output KnowledgeDocsBucketName) || exit 1
  aws s3 rm "s3://$bucket/" --recursive --region "$REGION"
}

case "${1:-}" in
  '') upload; ingest ;;
  upload) shift; upload "$@" ;;
  ingest) ingest ;;
  empty) empty ;;
  *) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
