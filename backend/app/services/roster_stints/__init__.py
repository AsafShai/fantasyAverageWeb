"""Roster stints: which NBA team each player was on, and when, this season.

feed.py      downloads and parses the NBA Player Movement feed
matching.py  maps the feed's NBA players to ESPN athlete ids
replay.py    turns feed rows plus box-score appearances into stints (pure)
service.py   nightly rebuild into nba_roster_stints, and reads
"""
