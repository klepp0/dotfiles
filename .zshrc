export CUSTUM_RC="$HOME/.config/custom-zshrc"

source $CUSTUM_RC/aliases.sh
source $CUSTUM_RC/exports.sh
source $CUSTUM_RC/functions.sh
source $CUSTUM_RC/oh-my-zsh.sh
source $CUSTUM_RC/secrets.sh
source $CUSTUM_RC/startup.sh

# The next line updates PATH for the Google Cloud SDK.
if [ -f "$HOME/dev/google-cloud-sdk/path.zsh.inc" ]; then . "$HOME/dev/google-cloud-sdk/path.zsh.inc"; fi

# The next line enables shell command completion for gcloud.
if [ -f "$HOME/dev/google-cloud-sdk/completion.zsh.inc" ]; then . "$HOME/dev/google-cloud-sdk/completion.zsh.inc"; fi
