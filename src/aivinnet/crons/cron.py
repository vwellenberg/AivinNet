from abc import ABC, abstractmethod

import schedule


class CronJob(ABC):
    """
    A cron job that will be run on a regular interval.

    ⚠️ It also runs ONCE AT STARTUP, and you cannot see that from this file.
    `start_cron_jobs()` in `crons/__init__.py` calls `schedule.run_all()` right
    after constructing every job, so `hours` is the interval BETWEEN runs, not a
    delay before the first one. Reading `schedule.every(12).hours` here and
    concluding "the first run is twelve hours after boot" is wrong — and it is a
    mistake that has actually been made while diagnosing an empty homepage row.
    """

    name: str
    hours: int = 1

    def __init__(self):
        # Registers the recurring run. The first run is triggered separately, by
        # schedule.run_all() in start_cron_jobs() — see the class docstring.
        schedule.every(self.hours).hours.do(self.run)

    @abstractmethod
    def run(self):
        """
        The function that will be called by the cron job.
        """
        ...
