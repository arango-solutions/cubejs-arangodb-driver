FROM cubejs/cube:v1.4.4

# Install the locally built driver tarball into Cube's conf node_modules, exactly
# how a user adds a community driver to their deployment. A minimal package.json
# makes npm treat /cube/conf as the install root (so the driver and its deps stay
# isolated from Cube's own /cube/node_modules). Cube's NODE_PATH includes
# /cube/conf/node_modules, so the driver is picked up automatically for
# CUBEJS_DB_TYPE=arangodb, while @cubejs-backend/schema-compiler (the optional peer
# used by dialectClass()) resolves from the image's /cube/node_modules.
COPY driver.tgz /tmp/driver.tgz
RUN cd /cube/conf \
    && npm init -y >/dev/null 2>&1 \
    && npm install --no-save /tmp/driver.tgz \
    && rm -f /tmp/driver.tgz
