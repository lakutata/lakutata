# The engine tests of @lakutata/containerd

The engine tests (`src/tests/engine`) need a containerd: they run in Docker, in privileged containers of the images of
this directory, each one with a version of containerd and of runc:

| Version | containerd | runc |
|---|---|---|
| 1.6 | 1.6.20 (Debian 12) | 1.1.5 |
| 1.7 | 1.7.36 | 1.3.6 |
| 2.4 | 2.4.1 | 1.5.2 |

```sh
test-env/run.sh             # all the versions
test-env/run.sh 2.4         # one of them
test-env/run.sh --build 1.7 # its image built again
```

The builds are tested with a local BuildKit (`buildkitd` of `moby/buildkit`, its containerd worker) and a remote one
(TCP). The containers and the network of the tests are removed after them; the images are kept.

All the versions run on the kernel of Docker (its virtual machine on macOS and Windows): the older kernels and cgroup v1
are not tested by them.
