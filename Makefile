.PHONY: test deep scan

check:
	@pnpm audit
	@pnpm prettier
	@pnpm lint
	@pre-commit run --all-files

fix:
	@pnpm prettier-fix
	@pnpm lint-fix

install:
	@pnpm install --frozen-lockfile

test:
	@pnpm test

check-all: check
	@(cd app && $(MAKE) check)

fix-all: fix
	@(cd app && $(MAKE) fix)

install-all: install
	@(cd app && $(MAKE) install)

test-all: test
	@(cd app && $(MAKE) test)
