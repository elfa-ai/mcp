# Elfa MCP

A multi-language project implementing MCP (Model Context Protocol) server for accessing Elfa's crypto and social media analytics.

## Project Structure

This repository contains both Python and TypeScript implementations:

- `/python` - Python implementation
- `/typescript` - TypeScript implementation (coming soon)
- `/docs` - Project documentation

## Getting Started

### Python Implementation

The Python implementation is located in the `/python` directory. For detailed setup instructions, see [python/README.md](python/README.md).

#### Installation

You can install the Python package directly from PyPI:

```sh
pip install elfa-mcp
```

Or install from the repository:

1. Navigate to the Python directory:

```sh
cd python
```

2. Install dependencies:

```sh
pip install -r requirements.txt
```

3. For development, install additional dependencies:

```sh
pip install -r requirements-dev.txt
```

#### Prerequisites

- Python 3.10 or higher
- Docker (optional, for containerized environment)
- An Elfa API key (get one at [elfa.ai](https://elfa.ai))

### TypeScript Implementation

The TypeScript implementation is located in the `/typescript` directory.

## Documentation

Detailed documentation can be found in the [docs](docs/) directory:

- [Installation Guide](docs/installation.md)

## Contributing

1. Ensure you have the necessary dependencies installed
2. Run tests before submitting any changes
3. Follow the existing code style and conventions

## License

This project is licensed under the terms found in [LICENSE](LICENSE).
