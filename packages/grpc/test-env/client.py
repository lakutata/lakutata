# The client of the tests of interoperability: the official gRPC of Python (grpcio) calling the service actions of
# lakutata over gRPC, its stubs generated from SERVICE_PROTO
import json
import sys

import grpc
from grpc_tools import protoc

if protoc.main(['', '-I/work', '--python_out=/work', '--grpc_python_out=/work', '/work/service.proto']) != 0:
    sys.exit('the stubs are not generated')
sys.path.insert(0, '/work')
import service_pb2 as pb  # noqa: E402
import service_pb2_grpc as rpc  # noqa: E402

target = sys.argv[1]
channel = grpc.insecure_channel(target)
stub = rpc.ServiceStub(channel)
metadata = [('id', 'python-1')]


def invoke(data, **options):
    return stub.Invoke(pb.InvokeRequest(data=json.dumps(data).encode()), metadata=metadata, **options)


def check(name, condition):
    print(('ok    ' if condition else 'FAIL  ') + name)
    if not condition:
        sys.exit(1)


response = invoke({'cmd': 'order.get', 'id': 5})
check('an action invoked, the id of its client given', response.success and json.loads(response.payload) == {'id': 5, 'client': 'python-1'})

response = invoke({'cmd': 'order.close'})
error = json.loads(response.error)
check('the error of an action', not response.success and error['errno'] == 'E_ORDER' and error['message'] == 'The order is closed')

response = invoke({'cmd': 'order.get', 'id': 'x'})
check('the input refused by its DTO', not response.success)

response = invoke({'cmd': 'order.get', 'id': 6}, compression=grpc.Compression.Gzip)
check('a request compressed by gzip, its response compressed', json.loads(response.payload)['id'] == 6)

try:
    invoke({'cmd': 'slow'}, timeout=0.2)
    check('the deadline of a call', False)
except grpc.RpcError as failure:
    check('the deadline of a call', failure.code() == grpc.StatusCode.DEADLINE_EXCEEDED)

try:
    invoke({'cmd': 'order.get', 'id': 1, 'note': 'x' * (2 * 1024 * 1024)})
    check('a request larger than the largest one', False)
except grpc.RpcError as failure:
    check('a request larger than the largest one', failure.code() == grpc.StatusCode.RESOURCE_EXHAUSTED)

events = stub.Events(pb.EventsRequest(), metadata=metadata)
first = next(events)
check('the events of the client: its id first', first.event == 'client' and json.loads(first.args) == ['python-1'])
invoke({'cmd': 'notify', 'count': 3})
pushed = next(events)
check('an event pushed to the client', pushed.event == 'pushed' and json.loads(pushed.args) == [{'count': 3}])
events.cancel()

print('INTEROP PYTHON OK')
