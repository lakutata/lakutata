# The containerd of the engine tests of @lakutata/containerd: a version of Debian (CONTAINERD_VERSION=debian), or an
# official release of containerd and of runc; the plugins of CNI, iptables, iproute2; the nested cgroup v2 of Docker
# made usable by its entrypoint
FROM node:24-bookworm
ARG CONTAINERD_VERSION=debian
ARG RUNC_VERSION
ARG TARGETARCH
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends containernetworking-plugins iptables iproute2 >/dev/null \
 && if [ "$CONTAINERD_VERSION" = "debian" ]; then apt-get install -y -qq --no-install-recommends containerd runc >/dev/null; fi \
 && rm -rf /var/lib/apt/lists/*
RUN if [ "$CONTAINERD_VERSION" != "debian" ]; then \
      curl -fsSL "https://github.com/containerd/containerd/releases/download/v${CONTAINERD_VERSION}/containerd-${CONTAINERD_VERSION}-linux-${TARGETARCH}.tar.gz" | tar -xz -C /usr/local \
      && curl -fsSL -o /usr/local/sbin/runc "https://github.com/opencontainers/runc/releases/download/v${RUNC_VERSION}/runc.${TARGETARCH}" \
      && chmod +x /usr/local/sbin/runc; \
    fi \
 && containerd --version && runc --version
RUN printf '#!/bin/sh\nif [ -f /sys/fs/cgroup/cgroup.controllers ]; then\n  mkdir -p /sys/fs/cgroup/init\n  xargs -rn1 < /sys/fs/cgroup/cgroup.procs > /sys/fs/cgroup/init/cgroup.procs 2>/dev/null || true\n  sed -e "s/ / +/g" -e "s/^/+/" < /sys/fs/cgroup/cgroup.controllers > /sys/fs/cgroup/cgroup.subtree_control\nfi\nexec "$@"\n' > /usr/local/bin/entrypoint \
 && chmod +x /usr/local/bin/entrypoint
ENTRYPOINT ["/usr/local/bin/entrypoint"]
CMD ["containerd"]
