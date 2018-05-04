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
psql -h localhost locophoto -c "alter table photo add column photosetid int default 0"
psql -h localhost locophoto -c "update photo set photosetid=rootid where rootid>0"
psql -h localhost locophoto -c "update photo p1 set photosetid=p2.rootid from photo p2 where p1.photosetid=0 and p2.rootid=p1.id and p2.rootid>0"



