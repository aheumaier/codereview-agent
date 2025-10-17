#!/bin/bash
# Code Churn Analysis Script
# Analyzes which files have changed most over different time periods
# Helps identify architectural hotspots that need attention

set -euo pipefail

# Configuration
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
OUTPUT_DIR="${REPO_ROOT}/reports"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Color output
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Thresholds
HOTSPOT_THRESHOLD=1000  # Lines changed to be considered architectural hotspot
HIGH_CHURN_THRESHOLD=500
MIN_DISPLAY_THRESHOLD=100  # Minimum lines changed to display in output

# File patterns to exclude
EXCLUDE_PATTERNS=(
  '*.json'
  '*.lock'
  '*.md'
  '*.txt'
  '*.config.js'
  '*.config.ts'
  'package-lock.json'
  'yarn.lock'
  'pnpm-lock.yaml'
  'conf/*'
  'data/*.db'
  'dist/*'
  'build/*'
  'node_modules/*'
  'coverage/*'
  '.github/*'
)

# Build git pathspec excludes
build_excludes() {
  local excludes=""
  for pattern in "${EXCLUDE_PATTERNS[@]}"; do
    excludes="$excludes ':(exclude)${pattern}'"
  done
  echo "$excludes"
}

# Detect git submodules
get_submodules() {
  if [ ! -f .gitmodules ]; then
    return
  fi

  git config --file .gitmodules --get-regexp path | awk '{print $2}'
}

# Analyze churn in a submodule
analyze_submodule() {
  local submodule_path="$1"
  local period="$2"

  if [ ! -d "$submodule_path" ]; then
    return
  fi

  # Check if it's a valid git repository
  if ! git -C "$submodule_path" rev-parse --git-dir > /dev/null 2>&1; then
    return
  fi

  # Run git log in the submodule and prefix paths with submodule name
  local cmd="git -C \"$submodule_path\" log --since=\"$period\" --numstat --pretty=format:'' -- \
    'app/**' 'tests/**' 'src/**' 'lib/**' \
    $(build_excludes)"

  eval "$cmd" | awk -v prefix="$submodule_path/" 'NF==3 {files[prefix $3]+=$1+$2} END {for (f in files) print files[f], f}'
}

# Analyze parent and all submodules, return merged results
analyze_with_submodules() {
  local period="$1"
  local temp_file=$(mktemp)

  # Analyze parent repository
  local cmd="git log --since=\"$period\" --numstat --pretty=format:'' -- \
    'app/**' 'tests/**' 'src/**' 'lib/**' \
    $(build_excludes)"

  eval "$cmd" | awk 'NF==3 {files[$3]+=$1+$2} END {for (f in files) print files[f], f}' >> "$temp_file"

  # Analyze each submodule
  while IFS= read -r submodule_path; do
    analyze_submodule "$submodule_path" "$period" >> "$temp_file"
  done < <(get_submodules)

  # Merge and sort all results
  if [ -s "$temp_file" ]; then
    sort -rn "$temp_file"
  fi

  rm -f "$temp_file"
}

# Analyze churn for a time period (with submodule support)
analyze_period() {
  local period="$1"
  local label="$2"

  echo -e "\n${BLUE}=== $label ===${NC}"

  # Get ALL results from parent + submodules (no limit)
  local results=$(analyze_with_submodules "$period")

  if [ -z "$results" ]; then
    echo "  No changes found in this period"
    return
  fi

  # Display results with color coding and source indicator (filter by threshold)
  local displayed_count=0

  # Use process substitution to preserve variable scope
  while read -r lines file; do
    # Skip files below minimum threshold
    if [ "$lines" -lt "$MIN_DISPLAY_THRESHOLD" ]; then
      continue
    fi

    local source_indicator=""

    # Determine if file is from submodule
    if [[ "$file" == *"/"* ]] && [ -f .gitmodules ]; then
      local potential_submodule=$(echo "$file" | cut -d'/' -f1)
      if get_submodules | grep -q "^${potential_submodule}$"; then
        source_indicator=" ${BLUE}[submodule]${NC}"
      fi
    fi

    # Color code by churn level
    if [ "$lines" -ge "$HOTSPOT_THRESHOLD" ]; then
      echo -e "  ${RED}🔥 $lines${NC}\t$file$source_indicator"
    elif [ "$lines" -ge "$HIGH_CHURN_THRESHOLD" ]; then
      echo -e "  ${YELLOW}⚠️  $lines${NC}\t$file$source_indicator"
    else
      echo -e "  ${GREEN}✓  $lines${NC}\t$file$source_indicator"
    fi

    displayed_count=$((displayed_count + 1))
  done < <(echo "$results")

  # Show message if no files meet threshold
  if [ "$displayed_count" -eq 0 ]; then
    echo -e "  ${YELLOW}(No files with >=$MIN_DISPLAY_THRESHOLD line changes)${NC}"
  fi
}

# Export to CSV (with submodule support)
export_csv() {
  local output_file="$1"

  echo "period,lines_changed,file_path,source" > "$output_file"

  for period_data in "1 month ago,1m" "3 months ago,3m" "1 year ago,1y"; do
    IFS=',' read -r period label <<< "$period_data"

    # Get merged results from parent + submodules
    analyze_with_submodules "$period" | while read -r lines file; do
      local source="parent"

      # Check if file is from a submodule
      if [[ "$file" == *"/"* ]] && [ -f .gitmodules ]; then
        local potential_submodule=$(echo "$file" | cut -d'/' -f1)
        if get_submodules | grep -q "^${potential_submodule}$"; then
          source="submodule:$potential_submodule"
        fi
      fi

      echo "$label,$lines,$file,$source"
    done >> "$output_file"
  done

  # Sort CSV by lines changed (descending) within each period
  {
    head -n 1 "$output_file"
    tail -n +2 "$output_file" | sort -t',' -k2 -rn
  } > "${output_file}.tmp" && mv "${output_file}.tmp" "$output_file"
}

# Main execution
main() {
  echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${BLUE}║          Code Churn Analysis - Architectural Hotspots          ║${NC}"
  echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"

  # Check if we're in a git repository
  if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo -e "${RED}Error: Not a git repository${NC}"
    exit 1
  fi

  echo -e "\n📊 Repository: $(basename "$REPO_ROOT")"
  echo -e "📅 Analysis Date: $(date '+%Y-%m-%d %H:%M:%S')"

  # Check for submodules
  local submodule_count=$(get_submodules | wc -l | tr -d ' ')
  if [ "$submodule_count" -gt 0 ]; then
    echo -e "🔗 Submodules detected: $submodule_count"
    get_submodules | while read -r sm; do
      echo -e "   └─ $sm"
    done
  fi

  # Analyze different time periods
  analyze_period "1 month ago" "ALL CHURNED FILES (LAST MONTH, ≥${MIN_DISPLAY_THRESHOLD} LOC)"
  analyze_period "3 months ago" "ALL CHURNED FILES (LAST 3 MONTHS, ≥${MIN_DISPLAY_THRESHOLD} LOC)"
  analyze_period "1 year ago" "ALL CHURNED FILES (LAST YEAR, ≥${MIN_DISPLAY_THRESHOLD} LOC)"

  # Legend
  echo -e "\n${BLUE}Legend:${NC}"
  echo -e "  ${RED}🔥 Architectural Hotspot${NC} (>= $HOTSPOT_THRESHOLD lines changed) - Needs immediate attention"
  echo -e "  ${YELLOW}⚠️  High Churn${NC} (>= $HIGH_CHURN_THRESHOLD lines changed) - Monitor closely"
  echo -e "  ${GREEN}✓  Normal Churn${NC} (>= $MIN_DISPLAY_THRESHOLD, < $HIGH_CHURN_THRESHOLD lines) - Stable code"
  if [ "$submodule_count" -gt 0 ]; then
    echo -e "  ${BLUE}[submodule]${NC} - File is from a git submodule"
  fi
  echo -e "\n  Note: Only showing files with >= $MIN_DISPLAY_THRESHOLD line changes"

  # Export CSV if reports directory exists or can be created
  if [ "${1:-}" = "--csv" ]; then
    mkdir -p "$OUTPUT_DIR"
    local csv_file="${OUTPUT_DIR}/churn-analysis-${TIMESTAMP}.csv"

    echo -e "\n📄 Exporting to CSV..."
    export_csv "$csv_file"
    echo -e "${GREEN}✓ CSV exported to: $csv_file${NC}"
  fi

  # Summary statistics
  echo -e "\n${BLUE}Summary Statistics:${NC}"

  # Total commits in last year
  local total_commits=$(git rev-list --count --since="1 year ago" HEAD)
  echo -e "  Total commits (1y): $total_commits"

  # Active contributors
  local contributors=$(git shortlog -sn --since="1 year ago" | wc -l | tr -d ' ')
  echo -e "  Active contributors (1y): $contributors"

  # Most active file in last year (use same logic as analyze_with_submodules)
  local most_active=$(analyze_with_submodules "1 year ago" | head -n 1)

  if [ -n "$most_active" ]; then
    echo -e "  Most churned file (1y): $most_active"
  fi

  echo -e "\n${GREEN}Analysis complete!${NC}"
  echo -e "\nTip: Run with ${YELLOW}--csv${NC} flag to export results: ${YELLOW}./scripts/churn-analysis.sh --csv${NC}"
}

# Run main function
main "$@"
