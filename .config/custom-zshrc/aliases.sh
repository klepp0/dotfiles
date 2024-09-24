alias vi="nvim"
alias vim="nvim"
alias tree="find . -print | sed -e 's;[^/]*/;|____;g;s;____|; |;g'"

# Delete local merged branches containing "klepp0"
alias cleanup-branches='git branch --merged | grep "klepp0" | egrep -v "(^\*|main|master)" | xargs git branch -d'

# Delete remote merged branches containing "klepp0"
alias prune-remote-branches='git branch -r --merged | grep "klepp0" | grep -vE "(^\*|master|main|HEAD)" | sed "s/origin\///" | xargs -n 1 git push --delete origin'

