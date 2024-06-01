#!/bin/bash

# Dotfiles directory
DOTFILES_DIR=$(pwd)

# List of files/folders to unlink in the home directory
FILES=".zshrc"

# Function to restore original files from backup
restore_file() {
    local file=$1
    local target=~/$file
    local backup=~/$file.bak

    if [ -L "$target" ] && [ "$(readlink $target)" == "$DOTFILES_DIR/$file" ]; then
        echo "Removing symlink $target"
        rm "$target"
        if [ -e "$backup" ]; then
            echo "Restoring backup $backup to $target"
            mv "$backup" "$target"
        fi
    fi
}

# Remove symlinks and restore files in the home directory
for file in $FILES; do
    restore_file $file
done

# Remove symlinks and restore files in the .config directory
find .config -type f | while read -r file; do
    restore_file "$file"
done

echo "Dotfiles have been uninstalled successfully."
