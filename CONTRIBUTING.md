# Contributing to Vector IDE (`vide`)

Thank you for your interest in contributing to Vector IDE! I welcome contributions from the community to help make Vector IDE a fast, lightweight, and modern development environment.

Please review this document before submitting bug reports, feature requests, or pull requests.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Licensing & Contributions](#licensing--contributions)
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Setup](#development-setup)
- [Coding & Style Guidelines](#coding--style-guidelines)

---

## Code of Conduct

This project is committed to providing a welcoming, inclusive, and harassment-free environment for everyone. Please treat all contributors and community members with mutual respect, kindness, and constructive feedback.

---

## Licensing & Contributions

Vector IDE is an open source project released under the **GNU General Public License v3.0 (GPLv3)**.

To keep the project sustainable while offering tailored enterprise deployments and architecture consulting services (e.g., custom white-label builds for organizations with strict proprietary constraints), I operate under a simple, pragmatic community approach:

### 1. Small & Routine Contributions (No Formalities Needed)
I believe contributing to open source should be friction-free:
* **Bug fixes, documentation improvements, UI polishes, refactoring, and routine improvements** are completely exempt from any formal agreements or legal paperwork.
* They are simply contributed under GPLv3 as standard open source contributions. You retain your copyright, and no contributor agreement is required.

### 2. Major Features & Subsystems
For substantial architectural additions or major new features:
* By opening a Pull Request for large features, you agree that your code is licensed under GPLv3 for the community, and you grant Ori Kuttner permission to include your contribution in official project releases and custom consulting builds without relicensing conflicts.
* I keep this lightweight and transparent—no complex legal portals or bureaucratic hurdles.

---

## How Can I Contribute?

### Reporting Bugs
Before filing an issue, please search existing issues to check if the bug has already been reported.

When opening a bug report, include:
* A concise, descriptive title.
* Clear steps to reproduce the issue.
* Expected behavior vs. actual behavior.
* Operating system and architecture (e.g., Ubuntu 24.04 x64, macOS Sequoia M2, Windows 11).
* Vector IDE version (from `vide --version` or the About dialog).
* Relevant error logs or console output.

### Suggesting Features & Enhancements
Feature requests are welcome! When opening a feature request:
* Describe the problem or workflow limitation you are experiencing.
* Outline the proposed solution or UI behavior.
* Consider alternatives or workarounds you have evaluated.

### Submitting Pull Requests
1. **Fork the repository** on GitHub to your account.
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/<your-username>/vide.git
   cd vide
   ```
3. **Create a topic branch**:
   ```bash
   git checkout -b feature/my-new-feature
   ```
4. **Make your changes** following the [Coding & Style Guidelines](#coding--style-guidelines).
5. **Verify that builds and checks pass**:
   ```bash
   npm run build
   cargo check --manifest-path src-tauri/Cargo.toml
   ```
6. **Commit your changes** with clear, descriptive commit messages.
7. **Push to your fork** and open a Pull Request against the `main` branch.
8. Open your Pull Request! For bug fixes, UI polishes, and routine improvements, no special agreements are needed.

---

## Development Setup

Vector IDE is built with an **Angular** frontend and a **Rust / Tauri v2** desktop backend.

### Prerequisites

* **Node.js**: `v20.x` or higher and `npm` (`>= 10.x`).
* **Rust**: Latest stable toolchain (1.90+ recommended).
  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  ```
* **System Dependencies (Linux)**:
  Tauri requires native WebKit and system libraries. On Debian / Ubuntu:
  ```bash
  sudo apt-get update
  sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
    libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
  ```
  *(For macOS and Windows prerequisites, refer to the [Tauri v2 Prerequisites Guide](https://tauri.app/start/prerequisites/).)*

### Local Installation & Development

1. Install Node dependencies:
   ```bash
   npm install
   ```

2. Start the Tauri development desktop app:
   ```bash
   npm run desktop
   ```
   This compiles the Angular frontend with live-reloading and starts the Tauri native shell with Hot Module Replacement (HMR).

3. To run the Angular frontend in a browser for rapid UI prototyping:
   ```bash
   npm start
   ```

### Verification & Quality Checks

Before pushing, verify code quality and formatting:

```bash
# Check code formatting with Prettier
npm run format

# Verify Angular frontend compilation
npm run build

# Verify Rust backend compilation
cargo check --manifest-path src-tauri/Cargo.toml
```

---

## Coding & Style Guidelines

### Language & Comments
* All source code comments, documentation, UI strings, and identifier names must be in **English**.
* Do not leave placeholder text in `<input>` elements unless specifically required by the design.

### Formatting
* The codebase uses **Prettier** for automated formatting across TypeScript, HTML, SCSS, and PHP files.
* Indentation uses **Tabs** with a tab width of 4.
* Run `npm run format` before staging files to ensure uniform style.

### Commit Messages
Please follow the [Conventional Commits](https://www.conventionalcommits.org/) format:
* `feat: add context menu option for file renaming`
* `fix: prevent duplicate history entries when closing tab`
* `docs: update installation instructions in README`
* `refactor: extract terminal shell spawning logic`

---

## Questions?
If you have questions about licensing, dedicated enterprise builds, or architectural inquiries, please reach out to Ori Kuttner at **[ori@heliconbooks.com](mailto:ori@heliconbooks.com)**.
