#!/bin/bash
# Verify Prerequisites for DonClaudioBot deployment to Hetzner VPS
# This script checks that the VPS is ready before deployment proceeds

set -e

VPS_HOST="135.181.93.227"
SSH_KEY="$HOME/.ssh/hetzner"
SSH_CMD="ssh -i $SSH_KEY root@$VPS_HOST"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

PASS_COUNT=0
FAIL_COUNT=0

check_pass() {
    echo -e "${GREEN}PASS${NC}: $1"
    PASS_COUNT=$((PASS_COUNT + 1))
}

check_fail() {
    echo -e "${RED}FAIL${NC}: $1"
    FAIL_COUNT=$((FAIL_COUNT + 1))
}

echo "=========================================="
echo "DonClaudioBot Prerequisite Verification"
echo "VPS: $VPS_HOST"
echo "=========================================="
echo

# 1. SSH Connectivity
echo -n "Checking SSH connectivity... "
if $SSH_CMD 'echo OK' > /dev/null 2>&1; then
    check_pass "SSH connection to $VPS_HOST"
else
    check_fail "Cannot connect via SSH to $VPS_HOST"
fi

# 2. Docker Installed
echo -n "Checking Docker installation... "
DOCKER_VERSION=$($SSH_CMD 'docker --version' 2>/dev/null)
if [ $? -eq 0 ]; then
    check_pass "Docker installed: $DOCKER_VERSION"
else
    check_fail "Docker is not installed on $VPS_HOST"
fi

# 3. No Existing Containers
echo -n "Checking for existing containers... "
CONTAINER_COUNT=$($SSH_CMD 'docker ps -a -q -f name=openclaw | wc -l' 2>/dev/null | tr -d ' ')
if [ "$CONTAINER_COUNT" -eq 0 ]; then
    check_pass "No existing OpenClaw containers"
else
    check_fail "Found $CONTAINER_COUNT existing OpenClaw container(s)"
fi

# 4. No Existing Volumes
echo -n "Checking for existing volumes... "
VOLUME_COUNT=$($SSH_CMD 'docker volume ls -q -f name=don-claudio | wc -l' 2>/dev/null | tr -d ' ')
if [ "$VOLUME_COUNT" -eq 0 ]; then
    check_pass "No existing don-claudio volumes"
else
    check_fail "Found $VOLUME_COUNT existing don-claudio volume(s)"
fi

# 5. Disk Space
echo -n "Checking disk space... "
DISK_AVAILABLE=$($SSH_CMD 'df -h / | tail -1 | awk "{print \$4}"' 2>/dev/null)
DISK_AVAILABLE_GB=$($SSH_CMD 'df -h / | tail -1 | awk "{print \$4}" | sed "s/G//"' 2>/dev/null)
if [ $? -eq 0 ]; then
    check_pass "Disk space available: $DISK_AVAILABLE"
else
    check_fail "Could not determine disk space"
fi

# Summary
echo
echo "=========================================="
echo "Verification Summary"
echo "=========================================="
echo "Passed: $PASS_COUNT"
echo "Failed: $FAIL_COUNT"
echo

if [ $FAIL_COUNT -eq 0 ]; then
    echo -e "${GREEN}All prerequisites met! Ready for deployment.${NC}"
    exit 0
else
    echo -e "${RED}Some prerequisites failed. Please fix before deploying.${NC}"
    exit 1
fi
