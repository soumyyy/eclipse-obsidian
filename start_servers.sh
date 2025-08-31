#!/bin/bash

# Get the absolute path to your project directory
PROJECT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Create the AppleScript commands
osascript <<EOF
tell application "Terminal"
    # Open backend terminal
    do script "cd '$PROJECT_DIR/backend' && source .venv/bin/activate && uvicorn app:app --reload --reload-exclude '**/.venv/**' --reload-exclude '**/site-packages/**' --reload-exclude '**/__pycache__/**' --reload-exclude 'data/**' --host 0.0.0.0 --port 8000"
    
    # Open frontend terminal
    do script "cd '$PROJECT_DIR/frontend' && npm run dev"
end tell
# EOF