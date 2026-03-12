#!/bin/zsh

# Dotfiles directory
DOTFILES_DIR=$(pwd)

# List of files/folders to symlink in the home directory
FILES=".zshrc"

# List of directories to symlink in the home directory
DIRS=".opencode"

# List of individual files to symlink into existing directories
# (for cases where we can't replace the entire directory)
CONFIG_FILES=".config/opencode/AGENTS.md"

# Function to create a backup of existing files
backup_file() {
    local file=$1
    if [ -e ~/$file ] && [ ! -L ~/$file ]; then
        echo "Backing up ~/$file to ~/$file.bak"
        mv ~/$file ~/$file.bak
    fi
}

# Function to create a backup of existing directories
backup_dir() {
    local dir=$1
    if [ -d ~/$dir ] && [ ! -L ~/$dir ]; then
        if [ -d ~/$dir.bak ]; then
            echo "Removing previous backup directory ~/$dir.bak"
            rm -rf ~/$dir.bak
        fi
        echo "Backing up ~/$dir to ~/$dir.bak"
        mv ~/$dir ~/$dir.bak
    fi
}

# Function to prompt user for each configuration
prompt_user() {
    local path=$1
    local type=$2
    read -p "Do you want to install $type $path? [y/N] " choice
    case "$choice" in
        y|Y ) return 0;;
        * ) return 1;;
    esac
}

# Create symlinks in the home directory
for file in $FILES; do
    if prompt_user $file "file"; then
        backup_file $file
        ln -sf $DOTFILES_DIR/$file ~/$file
    else
        echo "Skipping $file"
    fi
done

# Create symlinks for directories in the home directory
for dir in $DIRS; do
    if prompt_user $dir "directory"; then
        backup_dir $dir
        ln -sf $DOTFILES_DIR/$dir ~/$dir
    else
        echo "Skipping $dir"
    fi
done

# Directories under .config that are managed via CONFIG_FILES (individual file symlinks)
# and should NOT be symlinked as whole directories
CONFIG_FILE_DIRS=$(for f in $CONFIG_FILES; do dirname $f; done | sort -u)

# Create symlinks for the .config directory
for dir in $(find .config -mindepth 1 -maxdepth 1 -type d); do
    # Skip directories managed via individual file symlinks
    if echo "$CONFIG_FILE_DIRS" | grep -qx "$dir"; then
        continue
    fi
    base_dir=$(basename $dir)
    if prompt_user $base_dir "directory"; then
        backup_dir .config/$base_dir
        ln -sf $DOTFILES_DIR/.config/$base_dir ~/.config/$base_dir
    else
        echo "Skipping .config/$base_dir"
    fi
done

# Create symlinks for individual config files into existing directories
for config_file in $CONFIG_FILES; do
    if prompt_user $config_file "config file"; then
        target_dir=$(dirname ~/$config_file)
        mkdir -p $target_dir
        backup_file $config_file
        ln -sf $DOTFILES_DIR/$config_file ~/$config_file
    else
        echo "Skipping $config_file"
    fi
done

# Update shell
source ~/.zshrc

echo "Dotfiles have been installed successfully."
