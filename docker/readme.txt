GrowApp Photoserver Docker 
1. Create docker image for the GrowApp Photoserver:

docker build -t growapp-photoserver:1.0 .

2. Start the Photoserver with the appropriate settings:

docker run -d -p 3100:3100 -e "PGHOST=database.example.com" --dns=8.8.8.8 -v ./uploads:/home/node/growapp-mdl/server/uploads growapp-photoserver:1.0

Available RUN Settings

ENV PGHOST localhost
ENV PGPORT 5432
ENV PGUSER geodb
ENV PGPASSWORD geodb
ENV PGDATABASE locophoto
ENV PS_TRUSTED_PROXIES 127.0.0.1
ENV PS_TRUSTED_IPS 127.0.0.1
ENV PS_SMTPSERVER 127.0.0.1
ENV PS_SMTPPORT 25
ENV PS_SMTPUSER user
ENV PS_SMTPPASSWORD password
ENV PS_SMTPDOMAIN example.com

EXPOSE 3100
VOLUME /home/node/growapp-mdl/server/uploads

Some other commands:

You can view the output logs with:

docker logs container-id

where the container-id is the (first few letters of) the container-id printed from the "docker run" command or the obtain with "docker ps"

If you need to stop the server:

docker stop container-id

You can restart the container:

docker start container-id

