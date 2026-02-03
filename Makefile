.PHONY: all start restart clean

all: start

start:
	@make clean && \
	docker compose up --yes -d --quiet-pull --build

restart:
	docker compose restart

clean:
	@docker compose stop && \
	docker compose rm -f && \
	rm data/items.db
