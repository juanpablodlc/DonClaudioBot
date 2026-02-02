#!/bin/bash
# Integration test suite for docker-compose stack
# Must pass all tests before deploying to Hetzner

set -e

# Color output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PASS_COUNT=0
FAIL_COUNT=0

# Test functions
pass() {
    echo -e "${GREEN}✓ PASS${NC}: $1"
    PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
    echo -e "${RED}✗ FAIL${NC}: $1"
    FAIL_COUNT=$((FAIL_COUNT + 1))
}

info() {
    echo -e "${YELLOW}→${NC} $1"
}

# Cleanup function
cleanup() {
    info "Cleaning up..."
    cd /Users/jp/CodingProjects/DonClaudioBot
    docker compose -f docker/docker-compose.yml down -v 2>/dev/null || true
}

# Trap to ensure cleanup on exit
trap cleanup EXIT

# Start tests
echo "=========================================="
echo "Integration Test Suite"
echo "Testing docker-compose stack locally"
echo "=========================================="
echo ""

cd /Users/jp/CodingProjects/DonClaudioBot

# Test 1: Build and start
info "Test 1: Building and starting container..."
if docker compose -f docker/docker-compose.yml up --build -d; then
    pass "Build and start successful"
else
    fail "Build and start failed"
    exit 1
fi

# Test 2: Wait for startup
info "Test 2: Waiting for startup (30s)..."
sleep 30
pass "Startup wait completed"

# Test 3: Container running
info "Test 3: Checking container status..."
RUNNING_COUNT=$(docker ps --filter "status=running" --filter "name=don-claudio-bot" | grep -c "don-claudio-bot" || true)
if [ "$RUNNING_COUNT" -eq 1 ]; then
    pass "Container is running"
else
    fail "Container not running (found $RUNNING_COUNT containers)"
fi

# Test 4: Volume mounted
info "Test 4: Checking volume mount..."
if docker volume inspect don-claudio-state | jq -e '.[0].Mountpoint != null' >/dev/null 2>&1; then
    pass "Volume is mounted"
else
    fail "Volume not mounted correctly"
fi

# Test 5: Onboarding health endpoint
info "Test 5: Checking onboarding health endpoint..."
sleep 5  # Extra time for service to be ready
if curl -f -s http://localhost:3000/health | jq -e '.status == "ok"' >/dev/null 2>&1; then
    pass "Health endpoint responding"
else
    fail "Health endpoint check failed"
fi

# Test 6: Volume write test
info "Test 6: Testing volume write..."
if docker exec don-claudio-bot sh -c 'echo "TEST" > /home/node/.openclaw/volume-test.txt' 2>/dev/null && \
   docker exec don-claudio-bot sh -c 'test -f /home/node/.openclaw/volume-test.txt && cat /home/node/.openclaw/volume-test.txt' | grep -q "TEST"; then
    pass "Volume write test successful"
else
    fail "Volume write test failed"
fi

# Test 7: OpenClaw CLI works
info "Test 7: Testing OpenClaw CLI..."
if docker exec don-claudio-bot openclaw --version >/dev/null 2>&1; then
    pass "OpenClaw CLI is working"
else
    fail "OpenClaw CLI test failed"
fi

# Summary
echo ""
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo -e "Passed: ${GREEN}$PASS_COUNT${NC}"
echo -e "Failed: ${RED}$FAIL_COUNT${NC}"
echo ""

if [ $FAIL_COUNT -eq 0 ]; then
    echo -e "${GREEN}All tests passed! Ready for deployment.${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed. Fix before deploying.${NC}"
    exit 1
fi
