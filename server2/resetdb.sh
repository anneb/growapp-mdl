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
psql -h localhost locophoto -c "create table photosetlikes (id serial primary key, photosetid int, userid int, likes int)";
psql -h localhost locophoto -c "create unique index photosetlikesuseridx on photosetlikes (photosetid, userid)"
psql -h localhost locophoto -c "alter table photouser add column displayname varchar"
psql -h localhost locophoto -c "alter table photo add column highlight bool default false"
psql -h localhost locophoto -c "create index photorootididx on photo(rootid)"
psql -h localhost locophoto -c "create table if not exists hashtags (id serial primary key, photoid int, hashtag varchar)";
psql -h localhost locophoto -c "create index if not exists hashtagshastagidx on hashtags(hashtag)";




