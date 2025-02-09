ARG FROM_IMAGE

FROM ${FROM_IMAGE}

ARG TARGETARCH

ADD --chown=rapids:rapids \
    https://raw.githubusercontent.com/n-riesco/ijavascript/8637a3e18b89270121f49733d03af0e3e6e0a17a/images/nodejs/js-green-32x32.png \
    /opt/rapids/.local/share/jupyter/kernels/javascript/logo-32x32.png

ADD --chown=rapids:rapids \
    https://raw.githubusercontent.com/n-riesco/ijavascript/8637a3e18b89270121f49733d03af0e3e6e0a17a/images/nodejs/js-green-64x64.png \
    /opt/rapids/.local/share/jupyter/kernels/javascript/logo-64x64.png

ADD --chown=root:root \
    https://github.com/jupyterlab/jupyterlab-desktop/releases/download/v3.3.2-1/JupyterLab-Setup-Debian.deb \
    /tmp/JupyterLab-Setup-Debian.deb

USER root

# Manually install jupyter-kernelspec binary (for ijavascript)
RUN bash -c "echo -e '#!/usr/bin/python3\n\
import re\n\
import sys\n\
from jupyter_client.kernelspecapp import KernelSpecApp\n\
if __name__ == \"__main__\":\n\
    sys.argv[0] = re.sub(r\"(-script\\.pyw?|\\.exe)?\$\", \"\", sys.argv[0])\n\
    sys.exit(KernelSpecApp.launch_instance())\n\
' > /usr/bin/jupyter-kernelspec" \
 && chmod +x /usr/bin/jupyter-kernelspec \
 # Install ijavascript kernel
 && bash -c "echo -e '{\n\
  \"argv\": [\n\
    \"ijskernel\",\n\
    \"--hide-undefined\",\n\
    \"{connection_file}\",\n\
    \"--protocol=5.0\",\n\
    \"--session-working-dir=/opt/rapids/node\"\n\
  ],\n\
  \"name\": \"javascript\",\n\
  \"language\": \"javascript\",\n\
  \"display_name\": \"Javascript (Node.js)\"\n\
}' > /opt/rapids/.local/share/jupyter/kernels/javascript/kernel.json" \
 && chmod 0644 /opt/rapids/.local/share/jupyter/kernels/javascript/logo-{32x32,64x64}.png \
 && ln -s /opt/rapids/node/node_modules /opt/rapids/node_modules \
 && mkdir -p /opt/rapids/.jupyter \
 && mkdir -p /opt/rapids/.config/jupyterlab-desktop/lab/user-settings/@jupyterlab/apputils-extension \
 && bash -c "echo -e '{\n\
  \"theme\": \"JupyterLab Dark\"\n\
}' > /opt/rapids/.config/jupyterlab-desktop/lab/user-settings/@jupyterlab/apputils-extension/themes.jupyterlab-settings" \
 && chown -R rapids:rapids /opt/rapids \
 # Install Jupyter Desktop
 && apt update \
 && DEBIAN_FRONTEND=noninteractive \
    apt install -y --no-install-recommends \
    python3-minimal libasound2 jupyter-notebook /tmp/JupyterLab-Setup-Debian.deb \
 # Remove python3 kernelspec
 && jupyter kernelspec remove -f python3 \
 # Install ijavascript
 && npm install --global --unsafe-perm --no-audit --no-fund ijavascript \
 && ijsinstall --install=global --spec-path=full \
 \
 # Clean up
 && apt autoremove -y && apt clean \
 && rm -rf \
    /tmp/* \
    /var/tmp/* \
    /var/lib/apt/lists/* \
    /var/cache/apt/archives/*

USER rapids

WORKDIR /opt/rapids/node

SHELL ["/bin/bash", "-l"]

CMD ["jlab"]
