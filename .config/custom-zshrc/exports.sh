# homebrew
export PATH=/opt/homebrew/bin:$PATH
export PATH=/opt/homebrew/sbin:$PATH

# poetry
export PATH=$HOME/Library/Application\ Support/pypoetry/venv/bin:$PATH

# pyenv
export PYENV_ROOT="$HOME/.pyenv"
[[ -d $PYENV_ROOT/bin ]] && export PATH="$PYENV_ROOT/bin:$PATH"
eval "$(pyenv init -)"

# pipx
export PATH="$PATH:$HOME/.local/bin"

# docker
export PATH="$PATH:/Applications/Docker.app/Contents/Resources/bin/"

# npm
export PATH="$HOME/.npm-global/bin:$PATH"

# oh-my-zsh
[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh
source /opt/homebrew/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh

# k8s
export KUBECONFIG=~/kubeconfig.yaml
