#!/bin/bash

# Dotfiles directory
DOTFILES_DIR=$(pwd)

# List of files/folders to symlink in the home directory
FILES=".zshrc"

# Function to restore original files from backup
restore_file() {
    local file=$1
    if [ -L ~/$file ]; then
        echo "Removing symlink ~/$file"
        rm ~/$file
        if [ -e ~/$file.bak ]; then
            echo "Restoring backup ~/$file.bak to ~/$file"
            mv ~/$file.bak ~/$file
        fi
    fi
}

# Function to restore original directories from backup
restore_dir() {
    local dir=$1
    if [ -L ~/$dir ]; then
        echo "Removing symlink ~/$dir"
        rm ~/$dir
        if [ -d ~/$dir.bak ]; then
            echo "Restoring backup ~/$dir.bak to ~/$dir"
            mv ~/$dir.bak ~/$dir
        fi
    fi
}

# Function to prompt user for each configuration
prompt_user() {
    local path=$1
    local type=$2
    read -p "Do you want to uninstall $type $path? [y/N] " choice
    case "$choice" in
        y|Y ) return 0;;
        * ) return 1;;
    esac
}

# Remove symlinks in the home directory
for file in $FILES; do
    if prompt_user $file "file"; then
        restore_file $file
    else
        echo "Skipping $file"
    fi
done

# Remove symlinks for the .config directory
for dir in $(find .config -mindepth 1 -maxdepth 1 -type d); do
    base_dir=$(basename $dir)
    if prompt_user $base_dir "directory"; then
        restore_dir .config/$base_dir
    else
        echo "Skipping .config/$base_dir"
    fi
done

echo "Dotfiles have been uninstalled successfully."
