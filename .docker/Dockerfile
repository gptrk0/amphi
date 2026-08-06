FROM oven/bun

RUN apt-get update -y && \
    apt-get install -y openssl

COPY entrypoint.sh /entrypoint.sh

CMD ["/bin/bash", "/entrypoint.sh"]
