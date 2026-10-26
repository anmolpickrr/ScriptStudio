.PHONY: install dev-api dev-web test build docker

install:            ## install backend + frontend dependencies
	cd backend && python -m pip install -r requirements-dev.txt
	cd frontend && npm ci

dev-api:            ## API on :8000 (reads backend/.env)
	cd backend && uvicorn app.main:app --reload --port 8000

dev-web:            ## UI on :5173 with hot reload, proxying /api to :8000
	cd frontend && npm run dev

test:               ## backend tests + frontend type-check
	cd backend && python -m pytest -q
	cd frontend && npm run typecheck

build:              ## production frontend build (served by the API from frontend/dist)
	cd frontend && npm run build

docker:             ## production image
	docker build -t scriptwright .
