.PHONY: test test-go test-js test-e2e

test: test-go test-js test-e2e

test-go:
	go test ./...

test-js:
	node --test plugin/bridge/**/*.test.js

test-e2e:
	go test ./test/e2e -v
