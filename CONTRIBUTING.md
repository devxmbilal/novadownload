# Contributing to NovaDownload

Thank you for your interest in contributing to NovaDownload!

## Development Guidelines

1. **Code Quality**:
   - Keep frontend and backend clearly separated.
   - Use strong TypeScript typing across all stores and components.
   - Preserve robust error handling with `AppError` on the Rust side.
2. **Formatting & Linting**:
   - Rust: `cargo fmt` and `cargo clippy`
   - Frontend: `npm run typecheck` and `npm run lint`
3. **Download Engine Integrity**:
   - Never load large files into memory. Stream bytes directly to disk.
   - Always use `.part` temporary files until verification is complete.
