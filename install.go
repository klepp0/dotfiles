// dotfiles_installer.go

package main

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

var dotfilesDir string
var files = []string{
	".zshrc",
}

// Prompt the user for confirmation
func promptUser(path string, itemType string) bool {
	fmt.Printf("Do you want to install %s %s? [y/N]: ", itemType, path)
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Scan()
	choice := strings.ToLower(scanner.Text())
	return choice == "y" || choice == "yes"
}

// Create a backup of existing files
func backupFile(path string) error {
	fullPath := filepath.Join(os.Getenv("HOME"), path)
	if _, err := os.Stat(fullPath); err == nil {
		backupPath := fullPath + ".bak"
		fmt.Printf("Backing up %s to %s\n", fullPath, backupPath)
		return os.Rename(fullPath, backupPath)
	}
	return nil
}

// Create symlinks for files
func installFiles() {
	for _, file := range files {
		if promptUser(file, "file") {
			if err := backupFile(file); err != nil {
				fmt.Printf("Error backing up %s: %v\n", file, err)
				continue
			}
			sourcePath := filepath.Join(dotfilesDir, file)
			targetPath := filepath.Join(os.Getenv("HOME"), file)
			if err := os.Symlink(sourcePath, targetPath); err != nil {
				fmt.Printf("Error creating symlink for %s: %v\n", file, err)
			} else {
				fmt.Printf("Installed %s\n", file)
			}
		} else {
			fmt.Printf("Skipping %s\n", file)
		}
	}
}

// Create symlinks for .config directories
func installConfig() {
	configDir := filepath.Join(dotfilesDir, ".config")
	dirs, err := os.ReadDir(configDir)
	if err != nil {
		fmt.Printf("Error reading .config directory: %v\n", err)
		return
	}
	for _, dir := range dirs {
		if dir.IsDir() {
			if promptUser(dir.Name(), "directory") {
				sourcePath := filepath.Join(configDir, dir.Name())
				targetPath := filepath.Join(os.Getenv("HOME"), ".config", dir.Name())
				if err := os.RemoveAll(targetPath); err != nil {
					fmt.Printf("Error removing existing directory %s: %v\n", targetPath, err)
				}
				if err := os.Symlink(sourcePath, targetPath); err != nil {
					fmt.Printf("Error creating symlink for %s: %v\n", dir.Name(), err)
				} else {
					fmt.Printf("Installed .config/%s\n", dir.Name())
				}
			} else {
				fmt.Printf("Skipping .config/%s\n", dir.Name())
			}
		}
	}
}

// Source the .zshrc file
func sourceZshrc() {
	zshrcPath := filepath.Join(os.Getenv("HOME"), ".zshrc")
	if _, err := os.Stat(zshrcPath); err == nil {
		cmd := exec.Command("zsh", "-c", fmt.Sprintf("source %s", zshrcPath))
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err := cmd.Run(); err != nil {
			fmt.Printf("Error sourcing .zshrc: %v\n", err)
		}
	} else {
		fmt.Println("~/.zshrc not found. Skipping source step.")
	}
}

func main() {
	dotfilesDir, _ = os.Getwd()

	fmt.Println("Installing dotfiles...")

	installFiles()
	installConfig()

	sourceZshrc()

	fmt.Println("Dotfiles have been installed successfully.")
}

