#!/bin/bash

sudo -u postgres psql -c "drop database locophoto";
if [ $? -ne 0 ]; then
   echo "Failed to drop database, exiting"
   exit 1
fi
sudo -u postgres psql -c "create database locophoto";
sudo -u postgres psql locophoto -c "create extension postgis";
sudo -u postgres psql locophoto -f ~/locophoto.sql

export PGPASSWORD=geodb
export PGUSER=geodb
psql -h localhost locophoto -c "create table photosetlikes (id serial, photosetid int, userid int, likes int)";
psql -h localhost locophoto -c "create unique index photosetlikesuseridx on photosetlikes (photosetid, userid)"
psql -h localhost locophoto -c "alter table photouser add column displayname varchar"




