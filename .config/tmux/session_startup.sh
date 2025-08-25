#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
#  Tmux bootstrapper (called from .zshrc)
#  - Creates a set of named sessions in specific directories
#  - Never auto-attaches (so your shell won't get hijacked)
#  - Safe to run multiple times
# ==============================================================================

# --- CONFIGURATION ---
# List your session names here (order must match DIRECTORIES).
SESSIONS=("dev" "nvim" "dotfiles" "llm-service" "process-crafter" "process-evaluator" "x2p")

# Matching start directories for each session (use ~ for your home).
DIRECTORIES=("~/dev" "~/dev/nvim" "~/dev/dotfiles" "~/dev/llm-service" "~/dev/process-crafter" "~/dev/process-evaluator" "~/dev/x2p-discovery")

# --- SAFETY CHECKS ---

# Do nothing if tmux is not installed.
if ! command -v tmux >/dev/null 2>&1; then
  echo "Error: tmux is not installed. Skipping tmux setup."
  exit 0
fi

# If we're already inside tmux, don't create/attach anything.
if [ -n "${TMUX-}" ]; then
  exit 0
fi

# If any tmux session already exists, assume the setup has been done before and exit quietly.
if tmux ls >/dev/null 2>&1; then
  exit 0
fi

echo "Starting tmux setup..."

# --- SESSION CREATION ---

for i in "${!SESSIONS[@]}"; do
  session_name="${SESSIONS[$i]}"
  session_dir="${DIRECTORIES[$i]}"

  # Expand ~ to the absolute path.
  expanded_dir="$(eval echo "$session_dir")"

  # Ensure the directory exists.
  if [ ! -d "$expanded_dir" ]; then
    echo "Warning: directory '$expanded_dir' for session '$session_name' not found. Creating it..."
    mkdir -p "$expanded_dir"
  fi

  # Create the session only if it doesn't already exist.
  if ! tmux has-session -t "$session_name" 2>/dev/null; then
    echo "Creating session '$session_name' in '$expanded_dir'..."
    tmux new-session -d -s "$session_name" -c "$expanded_dir" -n "main"
  else
    echo "Session '$session_name' already exists. Skipping."
  fi
done

echo "Tmux setup complete."
# Note: no 'tmux attach' or 'tmux detach' here on purpose.
