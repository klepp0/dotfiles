# Automatic tmux session startup on interactive shell login
if [[ -z "$TMUX" && -n "$PS1" ]]; then
    ~/.config/tmux/session_startup.sh
fi
