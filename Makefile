.PHONY: help up down test lint build

help:
	@echo "Available commands:"
	@echo "  make up      - Start all services with docker compose"
	@echo "  make down    - Stop all docker compose services"
	@echo "  make test    - Run backend unit and integration tests"
	@echo "  make lint    - Run backend and frontend linters"
	@echo "  make build   - Rebuild all container images"

up:
	docker compose up --build -d

down:
	docker compose down

test:
	python -m pytest backend/tests/ -v

lint:
	cd frontend && npm run lint
	python -m flake8 backend/app/ || true

build:
	docker compose build
