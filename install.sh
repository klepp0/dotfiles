#!/bin/bash

# Dotfiles directory
DOTFILES_DIR=$(pwd)

# List of files/folders to symlink in the home directory
FILES=".zshrc"

# Function to create a backup of existing files
backup_file() {
    local file=$1
    if [ -e ~/$file ]  && [ ! -L ~/$file ]; then
        echo "Backing up ~/$file to ~/$file.bak"
        mv ~/$file ~/$file.bak
    fi
}

# Create symlinks in the home directory
for file in $FILES; do
    backup_file $file
    ln -sf $DOTFILES_DIR/$file ~/$file
done

# Create symlinks for the .config directory
for dir in $(find .config -type d); do
    mkdir -p ~/$dir
done

for file in $(find .config -type f); do
    backup_file $file
    ln -sf $DOTFILES_DIR/$file ~/$file
done

echo "Dotfiles have been installed successfully."
