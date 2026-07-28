FROM cubejs/cube:v1.4.4

# Version of arangodb-cubejs-driver to install. Override at build time:
#   docker build --build-arg DRIVER_VERSION=0.2.0 -t my/cube ./docker
ARG DRIVER_VERSION=0.2.0

# The driver installs into /cube/conf/node_modules (on Cube's NODE_PATH) and is
# loaded automatically for CUBEJS_DB_TYPE=arangodb. A minimal package.json keeps
# the driver and its dependencies isolated from Cube's own /cube/node_modules.
RUN cd /cube/conf \
    && npm init -y >/dev/null 2>&1 \
    && npm install --no-save "arangodb-cubejs-driver@${DRIVER_VERSION}"
