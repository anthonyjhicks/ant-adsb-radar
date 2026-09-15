#!/usr/bin/env bash
# Regenerate app/proto/readsb_pb2.py from the vendored readsb.proto.
# Runtime only needs the `protobuf` package; this codegen step needs protoc,
# which we get from grpcio-tools via uvx (no system protoc required).
set -euo pipefail
cd "$(dirname "$0")/../app/proto"

uvx --from grpcio-tools python -m grpc_tools.protoc -I. --python_out=. readsb.proto
echo "Regenerated readsb_pb2.py from readsb.proto"
