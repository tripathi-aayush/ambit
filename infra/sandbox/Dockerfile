FROM docker:27-dind

RUN apk add --no-cache python3 git bash

WORKDIR /sandbox
COPY runner.py entrypoint.sh ./
RUN chmod +x entrypoint.sh

ENTRYPOINT ["./entrypoint.sh"]
