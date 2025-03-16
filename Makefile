GO_EXECUTABLE = install
BUILD_DIR = ./build
SOURCE_FILE = install.go

build:
	@echo "Building the Go installer..."
	@mkdir -p $(BUILD_DIR)
	@go build -o $(BUILD_DIR)/$(GO_EXECUTABLE) $(SOURCE_FILE)
	@echo "Build complete. Executable located at $(BUILD_DIR)/$(GO_EXECUTABLE)"

install: build
	@echo "Running the dotfiles installer..."
	@$(BUILD_DIR)/$(GO_EXECUTABLE)

clean:
	@echo "Cleaning up build artifacts..."
	@rm -rf $(BUILD_DIR)
	@echo "Clean complete."
	@echo "Installing dotfiles ..."
	@git submodule update --merge --remote
	@chmod +x ./install.sh
	@./install.sh
	@echo "Done."

uninstall:
	@echo "Uninstalling dotfiles ..."
	@chmod +x ./uninstall.sh
	@./uninstall.sh
	@echo "Done."

help:
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@echo "  install   Install dotfiles"
	@echo "  uninstall Uninstall dotfiles"
	@echo "  clean     Clean up build artifacts"
	@echo "  help      Show this help message"
	@echo ""
	@echo "For more information, see the README.md file."
	@echo ""

# Targets
.PHONY: install clean uninstall help
