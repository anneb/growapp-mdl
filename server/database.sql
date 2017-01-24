create database locophoto owner geodb;
\c locaphoto;
create extension postgis;

-- create as user 'geodb'
create table photo (id serial primary key, filename varchar(40), width int, height int, location geometry, accuracy int, time timestamp default now(), visible boolean default(false), rootid int default 0, animationfilename varchar(40) default null, deviceid integer);
create table photouser (id serial primary key, email varchar(254), validated boolean, validationcode varchar(20), retrycount int, hash varchar(64));
create table if not exists device (id serial primary key, deviceid varchar(100), devicehash varchar(100), userid int, deviceip varchar(100), time timestamp default now());
create table move (id serial primary key, time timestamp);
