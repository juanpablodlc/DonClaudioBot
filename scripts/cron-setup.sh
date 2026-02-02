#!/bin/bash
set -e

# Cron Setup Script for DonClaudioBot
# Configures periodic tasks: reconciliation, OAuth monitoring, and backups
# This script is idempotent - safe to run multiple times

PROJECT_ROOT="/root/don-claudio-bot"
ONBOARDING_DIR="${PROJECT_ROOT}/onboarding"
LOG_DIR="/var/log"

echo "=== DonClaudioBot Cron Setup ==="
echo "Project root: ${PROJECT_ROOT}"
echo ""

# Function to check if a cron job already exists
cron_job_exists() {
    local job="$1"
    crontab -l 2>/dev/null | grep -Fq "$job"
}

# Initialize crontab if it doesn't exist
if ! crontab -l &>/dev/null; then
    echo "Initializing empty crontab..."
    crontab -l 2>/dev/null || true
fi

# Get existing crontab
existing_cron=$(crontab -l 2>/dev/null || true)

# 1. Hourly reconciliation job
reconciliation_job="0 * * * * cd ${ONBOARDING_DIR} && node dist/services/reconciliation.js >> ${LOG_DIR}/don-claudio-reconciliation.log 2>&1"
if echo "$existing_cron" | grep -Fq "reconciliation.js"; then
    echo "[SKIP] Hourly reconciliation job already exists"
else
    echo "[ADD] Hourly reconciliation job (runs at minute 0 every hour)"
    (crontab -l 2>/dev/null; echo "$reconciliation_job") | crontab -
fi

# 2. Daily OAuth expiry check (2 AM)
oauth_job="0 2 * * * cd ${ONBOARDING_DIR} && node dist/services/oauth-monitor.js >> ${LOG_DIR}/don-claudio-oauth.log 2>&1"
if echo "$existing_cron" | grep -Fq "oauth-monitor.js"; then
    echo "[SKIP] Daily OAuth check job already exists"
else
    echo "[ADD] Daily OAuth expiry check (runs at 2 AM daily)"
    (crontab -l 2>/dev/null; echo "$oauth_job") | crontab -
fi

# 3. Daily backup job (3 AM)
backup_job="0 3 * * * ${PROJECT_ROOT}/scripts/backup.sh >> ${LOG_DIR}/don-claudio-backup.log 2>&1"
if echo "$existing_cron" | grep -Fq "backup.sh"; then
    echo "[SKIP] Daily backup job already exists"
else
    echo "[ADD] Daily backup job (runs at 3 AM daily)"
    (crontab -l 2>/dev/null; echo "$backup_job") | crontab -
fi

# Ensure log directory exists and has correct permissions
echo ""
echo "[SETUP] Configuring log directory..."
sudo mkdir -p "${LOG_DIR}"
sudo chmod 755 "${LOG_DIR}"

# Create logrotate configuration
LOGROTATE_CONFIG="/etc/logrotate.d/don-claudio"
echo "[SETUP] Installing logrotate configuration to ${LOGROTATE_CONFIG}"

sudo tee "$LOGROTATE_CONFIG" > /dev/null << 'EOF'
# DonClaudioBot log rotation
# Rotates logs weekly, keeps 4 weeks of history

/var/log/don-claudio-reconciliation.log
/var/log/don-claudio-oauth.log
/var/log/don-claudio-backup.log {
    weekly
    rotate 4
    missingok
    notifempty
    compress
    delaycompress
    create 0644 root root
}
EOF

# Verify logrotate config syntax
if sudo logrotate -d "$LOGROTATE_CONFIG" &>/dev/null; then
    echo "[OK] Logrotate configuration is valid"
else
    echo "[WARN] Logrotate configuration may have issues (run 'sudo logrotate -d ${LOGROTATE_CONFIG}' to check)"
fi

echo ""
echo "=== Cron Jobs Installed ==="
echo ""
crontab -l | grep -E "reconciliation|oauth-monitor|backup.sh" || echo "No cron jobs found"
echo ""
echo "=== Setup Complete ==="
echo "Next run times:"
echo "  - Reconciliation: Next hour at :00 minutes"
echo "  - OAuth check: Daily at 2:00 AM"
echo "  - Backup: Daily at 3:00 AM"
