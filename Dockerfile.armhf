# specify the node base image with your desired version node:<version>
FROM arm32v7/node:8-stretch

# need qemu to emulate arm architecture
# can be downloaded here, $ docker run -v /usr/bin/qemu-arm-static:/usr/bin/qemu-arm-static --rm -ti arm32v7/debian:stretch-slim
COPY ./qemu-arm-static /usr/bin/qemu-arm-static

# install tools
RUN apt-get update \
  && apt-get install vim -y \
  && apt-get install rsync -y

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./

RUN npm install
# If you are building your code for production
# RUN npm install --only=production

# Bundle app source
COPY . .

RUN mkdir -p /root/.lnd

EXPOSE 3002
CMD [ "npm", "start" ]
