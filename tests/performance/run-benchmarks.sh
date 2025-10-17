#!/bin/bash

# Performance Benchmark Runner
# Run performance tests for sub-agent architecture

echo "================================================"
echo "   Sub-Agent Architecture Performance Tests    "
echo "================================================"
echo

# Run the performance benchmark tests
npx jest tests/performance/sub-agent-benchmark.test.js \
  --no-coverage \
  --verbose \
  --testTimeout=120000 \
  2>&1 | grep -E "(should|completed in|Parallel:|Sequential:|Speedup:|Performance|Average:|Scaling|Efficiency:|PASS|FAIL|Tests:)" | \
  sed 's/^/  /'

echo
echo "================================================"
echo "Performance benchmarks complete!"
echo

# Return appropriate exit code
if npx jest tests/performance/sub-agent-benchmark.test.js --no-coverage --silent 2>&1 | grep -q "FAIL"; then
  echo "❌ Some performance tests failed"
  exit 1
else
  echo "✅ All performance tests passed"
  exit 0
fi